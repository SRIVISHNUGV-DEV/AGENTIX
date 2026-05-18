"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = require("../src");
async function run() {
    const agent = new src_1.AgentClient("http://localhost:3000");
    await agent.init();
    const session = agent.sessionManager();
    console.log("Agent ready to act");
}
run();
