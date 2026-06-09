import axios from "axios"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { Wallet } from "ethers"
import { groth16 } from "snarkjs"
import { MerkleProof, SessionRequest, ZKProof } from "./types"

const CIRCUIT_WASM_PATH = path.resolve(
  __dirname,
  "../../../circuits/build/credential_js/credential.wasm"
)

const CIRCUIT_ZKEY_PATH = resolveZkeyPath()

function resolveZkeyPath() {
  const buildDir = path.resolve(__dirname, "../../../circuits/build")
  const zkey = fs.readdirSync(buildDir).find((file) => file.endsWith(".zkey"))

  if (!zkey) {
    throw new Error(`No .zkey file found in ${buildDir}`)
  }

  return path.join(buildDir, zkey)
}

export class SessionManager {

  api:string
  secret:bigint

  constructor(api:string, secret:bigint){
    this.api = api
    this.secret = secret
  }

  async fetchMerkleProof(agentId:number):Promise<MerkleProof>{

    const res = await axios.get(
      `${this.api}/sessions/proof/${agentId}`
    )

    return res.data
  }

  async generateProof(
    agentId:number,
    orgId:number,
    permissions:number,
    expiry:number,
    sessionNonce:number,
    proof:MerkleProof
  ):Promise<ZKProof>{

    const input = {

      agentId: agentId.toString(),
      orgId: orgId.toString(),
      permissions: permissions.toString(),
      expiry: expiry.toString(),
      secret: this.secret.toString(),

      sessionNonce: sessionNonce.toString(),

      activePathElements: proof.activePathElements,
      activePathIndices: proof.activePathIndices,
      revokedSiblings: proof.revokedSiblings,
      revokedOldKey: proof.revokedOldKey,
      revokedOldValue: proof.revokedOldValue,
      revokedIsOld0: proof.revokedIsOld0,

      activeRoot: proof.activeRoot,
      revokedRoot: proof.revokedRoot,

      maxValue: permissions.toString(),
      sessionExpiry: Math.floor(Date.now()/1000 + 604800).toString()
    }

    const { proof:zkProof, publicSignals } =
      await groth16.fullProve(
        input,
        CIRCUIT_WASM_PATH,
        CIRCUIT_ZKEY_PATH
      )

    return {
      proof: zkProof,
      publicSignals
    }
  }

  createSessionWallet(){
    return Wallet.createRandom()
  }

  async submitSession(
    agentId:number,
    zk:ZKProof,
    sessionKey:string,
    sessionId?:string
  ){
    const normalizedProof = this.normalizeScalars(zk.proof)
    const normalizedPublicSignals = this.normalizeScalars(zk.publicSignals)
    const expiry = Number(zk.publicSignals[4])
    const request: SessionRequest = {
      agentId,
      sessionId: sessionId ?? this.createSessionId(agentId, sessionKey),
      sessionKey,
      maxValue: Number(zk.publicSignals[3]),
      expiry,
      proof: normalizedProof,
      publicSignals: normalizedPublicSignals
    }

    const res = await axios.post(
      `${this.api}/sessions`,
      request
    )

    return res.data
  }

  createSessionId(agentId:number, sessionKey:string){
    return `0x${crypto
      .createHash("sha256")
      .update(`${agentId}:${sessionKey}:${Date.now()}`)
      .digest("hex")}`
  }

  private normalizeScalars<T>(value:T):T{
    if (typeof value === "bigint") {
      return value.toString() as T
    }

    if (typeof value === "number") {
      return Math.trunc(value).toString() as T
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeScalars(item)) as T
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.normalizeScalars(item)])
      ) as T
    }

    return value
  }

}
