import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { isPublicAddress, federationUrl, federationAddresses, pinnedLookup, federationFetch } from './federation-transport';
import { securityFixture } from './security-fixture';
it('rejects nonpublic destinations, mixed DNS answers and unsafe URLs, and pins approved DNS', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '0.0.0.0', '100.64.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::'])
        expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
        expect(isPublicAddress(ip)).toBe(true);
    for (const url of ['http://example.com', 'https://user:password@example.com', 'file:///etc/passwd', 'https://example.com/#fragment'])
        expect(() => federationUrl(url)).toThrow();
    expect(() => federationUrl('https://example.com/api', true)).toThrow();
    const signal = AbortSignal.timeout(1000);
    await expect(federationAddresses('mixed.test', signal, async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toThrow('not public');
    await expect(federationFetch('https://127.0.0.1/api')).rejects.toThrow('not public');
    const addresses = await federationAddresses('approved.test', signal, async () => [{ address: '1.1.1.1', family: 4 }]);
    // A later lookup never queries DNS again, including an automatic dual-stack lookup.
    const lookup = pinnedLookup(addresses);
    await new Promise<void>((resolve, reject) => lookup('approved.test', { all: true }, (error, actual) => { try {
        expect(error).toBeNull();
        expect(actual).toEqual(addresses);
        resolve();
    }
    catch (e) {
        reject(e);
    } }));
});
it('allows explicitly trusted private peers without forwarding redirects or unbounded responses', async () => {
    const prior = process.env.ORGOPS_FEDERATION_TRUSTED_ORIGINS;
    let forwarded = 0;
    const target = createServer((_req, res) => { forwarded++; res.end('not reached'); });
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    const targetPort = (target.address() as {
        port: number;
    }).port;
    const server = createServer((req, res) => {
        if (req.url === '/redirect') {
            res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/` });
            res.end();
        }
        else if (req.url === '/large') {
            res.end(Buffer.alloc(16 * 1024 * 1024 + 1));
        }
        else {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as {
        port: number;
    }).port}`;
    try {
        process.env.ORGOPS_FEDERATION_TRUSTED_ORIGINS = origin;
        expect(await (await federationFetch(origin + '/ok')).json()).toEqual({ ok: true });
        await expect(federationFetch(origin + '/redirect', { headers: { authorization: 'Bearer synthetic' } })).rejects.toThrow();
        expect(forwarded).toBe(0);
        await expect(federationFetch(origin + '/large')).rejects.toThrow('too large');
    }
    finally {
        if (prior === undefined)
            delete process.env.ORGOPS_FEDERATION_TRUSTED_ORIGINS;
        else
            process.env.ORGOPS_FEDERATION_TRUSTED_ORIGINS = prior;
        await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => target.close(() => r()))]);
    }
});
it('scopes peer tokens to explicit channels and secret-free agent transfers', async () => {
    const f = await securityFixture();
    const priorKey = process.env.ORGOPS_MASTER_KEY;
    process.env.ORGOPS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
        expect((await f.request('/api/federation/instances', { name: 'denied', baseUrl: 'https://peer.example' }, f.member)).status).toBe(403);
        const peer = await (await f.request('/api/federation/instances', { name: 'peer', baseUrl: 'https://peer.example' })).json();
        const token = { 'content-type': 'application/json', authorization: `Bearer ${peer.inboundToken}` };
        const channel = await (await f.request('/api/channels', { name: 'private', visibility: 'PRIVATE' })).json();
        const other = await (await f.request('/api/channels', { name: 'other', visibility: 'PRIVATE' })).json();
        for (const method of ['GET', 'POST'])
            expect((await f.request(`/api/federation/channels/${channel.id}/events`, method === 'POST' ? { type: 'message.created', source: 'remote', payload: { text: 'hello' } } : undefined, token, method)).status).toBe(403);
        expect((await f.request('/api/agents', { name: 'PrivateAgent', modelId: 'fixture', workspacePath: f.dir + '/private-agent', visibility: 'PRIVATE' })).status).toBe(201);
        await f.request('/api/secrets', { key: 'SENTINEL', value: 'synthetic-private-value', scopeType: 'private', scopeId: 'PrivateAgent' });
        expect((await f.request('/api/federation/agents/PrivateAgent/transfer', undefined, token)).status).toBe(403);
        const transfer = { agent: { name: 'Imported', workspacePath: '/etc', mode: 'CLASSIC', allowOutsideWorkspace: true, allowOwnerHumanSecrets: true, additionalSkillRoots: ['/etc'], assignedRunnerId: 'host' }, workspaceFiles: [], skills: [], secrets: [] };
        expect((await f.request('/api/federation/agents/transfer', transfer, token)).status).toBe(403);
        expect((await f.request(`/api/federation/instances/${peer.id}`, { metadata: { allowedChannelIds: [channel.id], allowedAgentExports: ['PrivateAgent'], allowedAgentImports: ['Imported'] } }, f.owner, 'PATCH')).status).toBe(200);
        await f.request('/api/federation/channels', { role: 'LOCAL_HOME', localChannelId: channel.id });
        expect((await f.request(`/api/federation/channels/${channel.id}/events`, { type: 'message.created', source: 'remote', payload: { text: 'approved' }, idempotencyKey: 'same' }, token)).status).toBe(201);
        expect((await f.request(`/api/federation/channels/${channel.id}/events`, undefined, token)).status).toBe(200);
        expect((await f.request(`/api/federation/channels/${other.id}/events`, undefined, token)).status).toBe(403);
        const bundle = await (await f.request('/api/federation/agents/PrivateAgent/transfer', undefined, token)).json();
        expect(bundle.secrets).toEqual([]);
        expect(JSON.stringify(bundle)).not.toContain('synthetic-private-value');
        expect((await f.request('/api/federation/agents/transfer', { ...transfer, secrets: [{ name: 'bad', value: 'synthetic' }] }, token)).status).toBe(403);
        expect((await f.request('/api/federation/agents/transfer', transfer, token)).status).toBe(201);
        const imported = await (await f.request('/api/agents/Imported')).json();
        expect(imported.desiredState).toBe('STOPPED');
        expect(imported.assignedRunnerId).toBeNull();
        expect(imported.visibility).toBe('PRIVATE');
        expect(imported.allowOutsideWorkspace).toBe(false);
        expect(imported.allowOwnerHumanSecrets).toBe(false);
        expect(imported.additionalSkillRoots).toEqual([]);
        expect(imported.workspacePath).not.toBe('/etc');
    }
    finally {
        if (priorKey === undefined)
            delete process.env.ORGOPS_MASTER_KEY;
        else
            process.env.ORGOPS_MASTER_KEY = priorKey;
        f.close();
    }
});
