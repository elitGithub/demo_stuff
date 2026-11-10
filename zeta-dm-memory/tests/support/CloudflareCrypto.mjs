import { timingSafeEqual } from 'node:crypto';

export default class CloudflareCrypto {
    /**
     * @param {import('node:test').TestContext} testContext
     * @return {number[][]}
     */
    static install(testContext) {
        const digestSizes = [];
        const subtle = globalThis.crypto.subtle;
        const original = Object.getOwnPropertyDescriptor(subtle, 'timingSafeEqual');
        Object.defineProperty(subtle, 'timingSafeEqual', {
            configurable: true,
            value: (supplied, configured) => {
                digestSizes.push([supplied.byteLength, configured.byteLength]);
                return timingSafeEqual(new Uint8Array(supplied), new Uint8Array(configured));
            },
        });
        testContext.after(() => {
            if (original) {
                Object.defineProperty(subtle, 'timingSafeEqual', original);
            } else {
                Reflect.deleteProperty(subtle, 'timingSafeEqual');
            }
        });
        return digestSizes;
    }
}
