"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCrypto = initCrypto;
exports.poseidonHash = poseidonHash;
const circomlibjs_1 = require("circomlibjs");
let poseidonInstance;
async function initCrypto() {
    if (!poseidonInstance) {
        poseidonInstance = await (0, circomlibjs_1.buildPoseidon)();
    }
}
function poseidonHash(inputs) {
    if (!poseidonInstance) {
        throw new Error("Crypto not initialized");
    }
    const res = poseidonInstance(inputs);
    return BigInt(poseidonInstance.F.toString(res));
}
