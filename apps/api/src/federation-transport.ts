import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const)
    blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
export function isPublicAddress(address: string): boolean {
    const family = isIP(address);
    return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
function trusted(origin: string): boolean {
    return (process.env.ORGOPS_FEDERATION_TRUSTED_ORIGINS ?? '').split(',').map(x => x.trim()).includes(origin);
}
export function federationUrl(value: string, baseOnly = false): URL {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || (baseOnly && (url.pathname !== '/' || url.search)))
        throw Error('Invalid federation URL');
    if (url.protocol !== 'https:' && !trusted(url.origin))
        throw Error('Federation requires HTTPS or an explicitly trusted origin');
    return url;
}
export function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
    return (_host, options, callback) => {
        const candidates = options.family ? addresses.filter(x => x.family === options.family) : addresses;
        if (!candidates.length)
            return callback(Error('No approved address'), '', 0);
        if (options.all)
            callback(null, candidates);
        else
            callback(null, candidates[0].address, candidates[0].family);
    };
}
export async function federationAddresses(host: string, signal: AbortSignal, resolveHost = (name: string) => lookup(name, { all: true })): Promise<LookupAddress[]> {
    const literal = host.replace(/^\[|\]$/g, '');
    const addresses = isIP(literal) ? [{ address: literal, family: isIP(literal) }] : await new Promise<LookupAddress[]>((resolve, reject) => {
        const abort = () => reject(Error('Federation lookup timed out'));
        if (signal.aborted)
            return abort();
        signal.addEventListener('abort', abort, { once: true });
        resolveHost(literal).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    if (!addresses.length || addresses.some(x => !isPublicAddress(x.address)))
        throw Error('Federation destination is not public');
    return addresses;
}
const maxBytes = 16 * 1024 * 1024;
/** Every federation path uses the same destination policy; redirects never forward credentials. */
export async function federationFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const url = federationUrl(input), signal = AbortSignal.any([AbortSignal.timeout(10000), ...(init.signal ? [init.signal] : [])]);
    if (trusted(url.origin)) {
        const response = await fetch(url, { ...init, redirect: 'error', signal });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            if (reader)
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    size += value.byteLength;
                    if (size > maxBytes)
                        throw Error('Federation response too large');
                    chunks.push(value);
                }
        }
        finally {
            await reader?.cancel();
        }
        return new Response([204, 205, 304].includes(response.status) ? null : new Uint8Array(Buffer.concat(chunks)), { status: response.status, headers: response.headers });
    }
    const addresses = await federationAddresses(url.hostname, signal);
    const headers = new Headers(init.headers);
    headers.delete('host');
    headers.set('accept-encoding', 'identity');
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string' && !(init.body instanceof Uint8Array))
        throw Error('Unsupported federation body');
    const outgoingHeaders: Record<string, string> = {};
    headers.forEach((value, key) => { outgoingHeaders[key] = value; });
    return new Promise<Response>((resolve, reject) => {
        const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: init.method ?? 'GET', headers: outgoingHeaders, lookup: pinnedLookup(addresses), agent: false, signal }, res => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) {
                req.destroy(Error('Federation response too large'));
                return;
            } chunks.push(chunk); });
            res.on('error', reject);
            res.on('end', () => {
                const resultHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers))
                    if (value !== undefined)
                        resultHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
                resolve(new Response([204, 205, 304].includes(res.statusCode ?? 200) ? null : new Uint8Array(Buffer.concat(chunks)), { status: res.statusCode ?? 502, headers: resultHeaders }));
            });
        });
        req.on('error', reject);
        if (init.body)
            req.write(init.body);
        req.end();
    });
}
