const axios = require("axios");
const { AgentClient } = require("../sdk/dist/src");

async function main() {
  const api = "http://127.0.0.1:3000";
  const client = new AgentClient(api);
  await client.init();

  console.log("STEP:register-agent");
  const registration = await client.registerAgent({
    orgName: `Sepolia Org ${Date.now()}`,
    agentName: `Agent ${Date.now()}`,
    permissions: 7,
    expiry: Math.floor(Date.now() / 1000) + 1209600
  });

  const agentId = registration.agentId;
  const orgId = registration.orgId;

  console.log("STEP:create-wallet");
  const wallet = await client.createWallet({ agentId });

  console.log("STEP:create-session");
  const session = await client.createSession({
    agentId
  });

  console.log("STEP:sync-events");
  await client.syncEvents();

  console.log("STEP:get-state");
  const state = await client.getAgentState(agentId);

  console.log(JSON.stringify({
    registration,
    wallet,
    session,
    stateSummary: {
      wallets: state.wallets?.length ?? 0,
      sessions: state.sessions?.length ?? 0,
      events: state.events?.length ?? 0
    },
    latestEvents: (state.events ?? []).slice(0, 10)
  }, null, 2));
}

main().catch((error) => {
  const message = error.response?.data || error.message || error;
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exit(1);
});
