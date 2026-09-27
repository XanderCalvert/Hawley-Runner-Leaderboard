const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (const byte of view) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(secret: string, purpose: 'sign' | 'encrypt'): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
    const params = {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode('club-recap'),
        info: encoder.encode(purpose),
    };
    return purpose === 'sign'
        ? crypto.subtle.deriveKey(params, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify'])
        : crypto.subtle.deriveKey(params, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Signs a small JSON payload so it can round-trip through Strava's OAuth `state` untouched. */
export async function signState(secret: string, payload: object): Promise<string> {
    const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
    const key = await deriveKey(secret, 'sign');
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    return `${body}.${toBase64Url(signature)}`;
}

export async function verifyState<T>(secret: string, state: string, maxAgeMs: number): Promise<T | null> {
    const [body, signature] = state.split('.');
    if (!body || !signature) {
        return null;
    }
    const key = await deriveKey(secret, 'sign');
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), encoder.encode(body));
    if (!valid) {
        return null;
    }
    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as T & { iat?: number };
    if (typeof payload.iat !== 'number' || Date.now() - payload.iat > maxAgeMs) {
        return null;
    }
    return payload;
}

export async function encrypt(secret: string, plaintext: string): Promise<string> {
    const key = await deriveKey(secret, 'encrypt');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
    return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function decrypt(secret: string, value: string): Promise<string> {
    const [iv, ciphertext] = value.split('.');
    if (!iv || !ciphertext) {
        throw new Error('Malformed encrypted value');
    }
    const key = await deriveKey(secret, 'encrypt');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, key, fromBase64Url(ciphertext));
    return decoder.decode(plaintext);
}

/** Constant-time comparison for bearer tokens. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
    const [ha, hb] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(a)),
        crypto.subtle.digest('SHA-256', encoder.encode(b)),
    ]);
    const va = new Uint8Array(ha);
    const vb = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < va.length; i++) {
        diff |= (va[i] ?? 0) ^ (vb[i] ?? 0);
    }
    return diff === 0 && a.length === b.length;
}
