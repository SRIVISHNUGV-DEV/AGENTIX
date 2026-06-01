export type ProverStatus = {
  available: boolean
  wasmPath: string
  zkeyPath: string | null
}

export type ProofData = {
  proof: {
    a: string[] | [string, string]
    b: string[][] | [[string, string], [string, string]]
    c: string[] | [string, string]
    protocol?: string
  }
  publicSignals: string[]
}

export type ExecutionProof = {
  nullifier: string
  root: string
  revokedRoot: string
  proof: {
    a: [string, string]
    b: [[string, string], [string, string]]
    c: [string, string]
  }
  publicSignals: [string, string, string, string, string]
}

export type MCPToolResponse = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}
