"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = require("../src");
async function main() {
    const client = new src_1.AgentClient("http://localhost:3000");
    await client.init();
    const credential = {
        agentId: 1,
        orgId: 1,
        permissions: 7,
        expiry: 2000000000
    };
    await client.registerCredential(credential);
    const manager = client.sessionManager();
    const sessionWallet = manager.createSessionWallet();
    const proof = await manager.fetchMerkleProof(1);
    const zk = await manager.generateProof(1, 1, 7, 2000000000, Date.now(), proof);
    const res = await manager.submitSession(1, zk, sessionWallet.address);
    console.log(res);
    console.log("Session key:", sessionWallet.address);
    console.log("Session private key:", sessionWallet.privateKey);
}
main();
