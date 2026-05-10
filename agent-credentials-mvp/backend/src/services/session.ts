import crypto from "crypto"

export function createSessionId(agentId:number, sessionKey:string, nonce?:string){

    const seed = nonce ?? `${Date.now()}`

    return `0x${crypto
        .createHash("sha256")
        .update(`${agentId}:${sessionKey}:${seed}`)
        .digest("hex")}`
}
