import { AgentClient } from "../src"

async function run(){

  const agent = new AgentClient(
    "http://localhost:3000"
  )

  await agent.init()

  const session = agent.sessionManager()

  console.log("Agent ready to act")

}

run()