import { describe, expect, it } from "vitest";
import {
  SourceCreateSchema, SourceUpdateSchema, CatalogCreateSchema, CatalogUpdateSchema,
  RevisionRequestSchema, ReadCredentialSetSchema, GitRepositorySchema,
  CatalogRefSchema, CatalogConfigurationAuditSchema, CatalogSyncRequestSchema,
} from "./configuration";

const sourceInput = { sourceId:"team-source", repository:{url:"https://git.example.invalid/team/catalog.git"}, enabled:true, allowPackages:false };
const externalInput = { sourceId:"package-source", repository:{url:"https://forge.example.invalid/org/packages.git"}, enabled:true, allowPackages:true };
const sshInput = { sourceId:"ssh-source", repository:{url:"ssh://git.example.invalid/team/private.git", sshUser:"git"}, enabled:false, allowPackages:false };
const catalogInput = { catalogId:"team-catalog", sourceId:"team-source", displayName:"Team catalog", ref:"main", enabled:true };
const readInput = { expectedRevision:1, kind:"https-basic", username:"synthetic-reader", password:"synthetic-read-password-1234567890" };
const syncInput = { expectedRevision:1, indexPath:"catalog/index.json" };

describe("catalog configuration contracts", () => {
  it("canonicalizes spelling but preserves conservative connection identity", () => {
    expect(GitRepositorySchema.parse({url:"HTTPS://GIT.EXAMPLE.INVALID:443/team/catalog.git"})).toEqual(sourceInput.repository);
    expect(GitRepositorySchema.parse({url:"SSH://GIT.EXAMPLE.INVALID:22/team/private.git",sshUser:"git"})).toEqual(sshInput.repository);
    expect(GitRepositorySchema.parse({url:"ssh://[2001:0DB8::1]:2222/team/repo",sshUser:"git"})).toEqual({url:"ssh://[2001:db8::1]:2222/team/repo",sshUser:"git"});
    expect(GitRepositorySchema.parse({url:"https://192.0.2.1/team/repo"})).toEqual({url:"https://192.0.2.1/team/repo"});
    const variants = [sourceInput.repository, {url:"https://git.example.invalid/team/catalog"}, {url:"https://git.example.invalid/Team/catalog.git"}, {url:"ssh://git.example.invalid/team/catalog.git",sshUser:"git"}, {url:"ssh://git.example.invalid/team/catalog.git",sshUser:"other"}];
    expect(new Set(variants.map(v => JSON.stringify(GitRepositorySchema.parse(v)))).size).toBe(5);
  });
  it.each([
    "https://user:synthetic-read-password-1234567890@git.example.invalid/a/b", "https://@git.example.invalid/a/b",
    "https://git.example.invalid/a/b?token=synthetic-read-password-1234567890", "https://git.example.invalid/a/b#x",
    "https://git.example.invalid/a/../b", "https://git.example.invalid/a/%2e%2e/b", "https://git.example.invalid/a//b", "https://git.example.invalid/a/b/",
    "https://git.example.invalid:0/a/b", "https://git.example.invalid:65536/a/b", "https://0177.0.0.1/a/b", "https://2130706433/a/b",
    "https://0x/team/repo", "https://0x.0x.0x.0x/team/repo",
    "https://git.example.invalid./a/b", "https://git.example.invalid\\evil/a/b", "git@git.example.invalid:a/b", "file:///tmp/repo", "/tmp/repo", "ext::sh -c id", "--upload-pack=evil", "http://git.example.invalid/a/b",
    "https://git.example.invalid/a/b\n", "https://gít.example.invalid/a/b", "https://0x7f.0.0.1/a", "https://127.1/a", "https://256.1.1.1/a", "https://host:/a", "https://host:+22/a", "https://host/a/./b", "https://host/", "https://-host/a", "https://host/a b", "https://host/" + "a".repeat(129), "https://" + "a".repeat(64) + "/a", "https://host/" + "a/".repeat(1024),
  ])("rejects unsafe or ambiguous repository URL %s", url => {
    expect(GitRepositorySchema.safeParse({url}).success).toBe(false);
  });
  it.each([
    {url:sourceInput.repository.url,sshUser:"git"}, {url:"ssh://git.example.invalid/a/b"},
    {url:"ssh://git@git.example.invalid/a/b",sshUser:"git"}, {...sshInput.repository,sshUser:"-git"},
    {...sshInput.repository,sshUser:"a".repeat(65)}, {...sourceInput.repository,args:[]}, {url:null},
  ])("rejects invalid repository object %#", value => expect(GitRepositorySchema.safeParse(value).success).toBe(false));
  it.each(["-main", "a..b", "a//b", "a/", ".hidden", "a/.hidden", "a.lock", "a/b.lock", "main\n", "main.", "a".repeat(129), "é", ""])("rejects invalid ref %s", ref => expect(CatalogRefSchema.safeParse(ref).success).toBe(false));
  it("accepts inert configured refs and explicit creation policies", () => {
    for (const ref of ["main", "releases/v1", "abc123", "a".repeat(128)]) expect(CatalogRefSchema.parse(ref)).toBe(ref);
    for (const value of [sourceInput, externalInput, sshInput]) expect(SourceCreateSchema.parse(value)).toEqual(value);
    expect(CatalogCreateSchema.parse(catalogInput)).toEqual(catalogInput);
    for (const key of ["enabled", "allowPackages"]) {
      const incomplete = {...sourceInput}; Reflect.deleteProperty(incomplete,key);
      expect(SourceCreateSchema.safeParse(incomplete).success).toBe(false);
    }
    for (const extra of [{repositoryIdentity:"forged"}, {readCredentialRef:"forged"}, {enabled:"true"}, {allowPackages:null}, {sourceId:"Bad"}]) expect(SourceCreateSchema.safeParse({...sourceInput,...extra}).success).toBe(false);
    expect(CatalogCreateSchema.safeParse({...catalogInput,enabled:undefined}).success).toBe(false);
    expect(CatalogCreateSchema.safeParse({...catalogInput,credentialRef:"forged"}).success).toBe(false);
  });
  it("requires bounded revisions and nonempty mutable-only patches", () => {
    for (const expectedRevision of [0,2147483648,1.5,"1",null,undefined]) {
      expect(RevisionRequestSchema.safeParse({expectedRevision}).success).toBe(false);
      expect(SourceUpdateSchema.safeParse({expectedRevision,enabled:true}).success).toBe(false);
      expect(CatalogUpdateSchema.safeParse({expectedRevision,enabled:true}).success).toBe(false);
    }
    for (const expectedRevision of [1,2147483647]) expect(RevisionRequestSchema.parse({expectedRevision})).toEqual({expectedRevision});
    for (const input of [{}, {expectedRevision:1}, {expectedRevision:1,enabled:null}, {expectedRevision:1,enabled:"false"}, {expectedRevision:1,enabled:true,sourceId:"other"}, {expectedRevision:1,enabled:true,repository:sourceInput.repository}]) expect(SourceUpdateSchema.safeParse(input).success).toBe(false);
    for (const input of [{}, {expectedRevision:1}, {expectedRevision:1,enabled:true,catalogId:"other"}, {expectedRevision:1,enabled:true,sourceId:"other"}]) expect(CatalogUpdateSchema.safeParse(input).success).toBe(false);
    expect(SourceUpdateSchema.parse({expectedRevision:1,allowPackages:false})).toEqual({expectedRevision:1,allowPackages:false});
    expect(CatalogUpdateSchema.parse({expectedRevision:1,displayName:" Renamed "})).toEqual({expectedRevision:1,displayName:" Renamed "});
    expect(RevisionRequestSchema.safeParse({expectedRevision:1,url:"forged"}).success).toBe(false);
  });
  it.each(["", "   ", "a\n", "a\u007f", "a\u009f", "\ud800", "\udc00", "a".repeat(129)])("rejects invalid display name %#", displayName => {
    expect(CatalogCreateSchema.safeParse({...catalogInput,displayName}).success).toBe(false);
    expect(CatalogUpdateSchema.safeParse({expectedRevision:1,displayName}).success).toBe(false);
  });
  it("preserves Unicode display spacing", () => expect(CatalogCreateSchema.parse({...catalogInput,displayName:"  Équipe 😀  "}).displayName).toBe("  Équipe 😀  "));
  it("bounds display names by Unicode code points for creation and updates", () => {
    const displayName = "😀".repeat(128);
    expect(CatalogCreateSchema.parse({...catalogInput,displayName}).displayName).toBe(displayName);
    expect(CatalogUpdateSchema.parse({expectedRevision:1,displayName}).displayName).toBe(displayName);
    const tooLong = "😀".repeat(129);
    expect(CatalogCreateSchema.safeParse({...catalogInput,displayName:tooLong}).success).toBe(false);
    expect(CatalogUpdateSchema.safeParse({expectedRevision:1,displayName:tooLong}).success).toBe(false);
  });
  it("bounds credential UTF-8 bytes and preserves spaces and password colons", () => {
    expect(ReadCredentialSetSchema.parse(readInput)).toEqual(readInput);
    for (const username of [" ", " reader ", "é".repeat(128)]) for (const password of [" ", " pass:word ", "é".repeat(2048)]) {
      expect(ReadCredentialSetSchema.parse({...readInput,username,password})).toEqual({...readInput,username,password});
    }
    for (const username of ["", "reader:password", "é".repeat(129), "a".repeat(257), "a\n", "\u0080", "\ud800"]) expect(ReadCredentialSetSchema.safeParse({...readInput,username}).success).toBe(false);
    for (const password of ["", "é".repeat(2049), "a".repeat(4097), "a\n", "\u007f", "\u009f", "\udc00"]) expect(ReadCredentialSetSchema.safeParse({...readInput,password}).success).toBe(false);
    for (const extra of [{kind:"ssh"}, {credentialRef:"forged"}, {username:null}, {password:123}, {expectedRevision:0}]) expect(ReadCredentialSetSchema.safeParse({...readInput,...extra}).success).toBe(false);
  });
  it("accepts exact catalog sync requests and rejects unknown keys, unsafe paths and bad revisions", () => {
    expect(CatalogSyncRequestSchema.parse(syncInput)).toEqual(syncInput);
    for (const extra of [{sourceId:"gh"}, {catalogId:"ghc"}, {commit:"0123456789abcdef0123456789abcdef01234567"}, {ref:"main"}]) expect(CatalogSyncRequestSchema.safeParse({...syncInput,...extra}).success).toBe(false);
    const missing = {...syncInput}; Reflect.deleteProperty(missing,"indexPath");
    const missingRevision = {...syncInput}; Reflect.deleteProperty(missingRevision,"expectedRevision");
    for (const input of [missing, missingRevision, {}]) expect(CatalogSyncRequestSchema.safeParse(input).success).toBe(false);
    // A lone leading dot segment ("./x"), ".." and ".git" segments are unsafe; the frozen
    // RelativePathSchema deliberately accepts non-reserved dot-prefixed segments ("a/.hidden").
    for (const indexPath of ["", "..", ".", "./x", ".git/x", "a/..", "a/.git/x", "a/./b", "x".repeat(241), ["x".repeat(60),"x".repeat(60),"x".repeat(60),"x".repeat(60)].join("/"), "a/", "a//b", "a\\b", "a "]) expect(CatalogSyncRequestSchema.safeParse({...syncInput,indexPath}).success).toBe(false);
    for (const expectedRevision of [0, -1, 1.5, "1", null, 2147483648, Number.NaN]) expect(CatalogSyncRequestSchema.safeParse({...syncInput,expectedRevision}).success).toBe(false);
    for (const expectedRevision of [1, 2147483647]) expect(CatalogSyncRequestSchema.parse({...syncInput,expectedRevision})).toEqual({...syncInput,expectedRevision});
  });
  it("restricts audit fields and couples catalog handles to catalog actions", () => {
    const audit = {actorHumanId:"human-owner",sourceId:"team-source",revision:2};
    for (const action of ["source.create", "source.update", "source.remove", "source.restore", "read-credential.set", "read-credential.revoke"]) {
      expect(CatalogConfigurationAuditSchema.safeParse({...audit,action}).success).toBe(true);
      expect(CatalogConfigurationAuditSchema.safeParse({...audit,action,catalogId:"team-catalog"}).success).toBe(false);
    }
    for (const action of ["catalog.create", "catalog.update", "catalog.remove", "catalog.restore"]) {
      expect(CatalogConfigurationAuditSchema.safeParse({...audit,action,catalogId:"team-catalog"}).success).toBe(true);
      expect(CatalogConfigurationAuditSchema.safeParse({...audit,action}).success).toBe(false);
    }
    for (const extra of [{password:readInput.password}, {url:sourceInput.repository.url}, {displayName:"Team"}, {ref:"main"}, {credentialRef:"secret"}, {kind:"https-basic"}, {username:"reader"}, {ciphertext:"secret"}, {action:"fetch"}, {actorHumanId:""}, {actorHumanId:"a".repeat(129)}, {sourceId:"BAD"}, {revision:0}, {revision:2147483648}]) expect(CatalogConfigurationAuditSchema.safeParse({...audit,action:"source.create",...extra}).success).toBe(false);
  });
});
