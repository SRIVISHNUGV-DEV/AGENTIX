declare module "snarkjs" {
  export const groth16: {
    prove: (zkey: any, witness: any) => Promise<{ proof: any; publicSignals: any }>
    verify: (vk: any, publicSignals: any, proof: any) => Promise<boolean>
    fullProve: (input: any, wasm: any, zkey: any) => Promise<{ proof: any; publicSignals: any }>
    exportSolidityVerifierKey: (vk: any) => Promise<string>
  }
  export const plonk: {
    prove: (zkey: any, witness: any) => Promise<{ proof: any; publicSignals: any }>
    verify: (vk: any, publicSignals: any, proof: any) => Promise<boolean>
    fullProve: (input: any, wasm: any, zkey: any) => Promise<{ proof: any; publicSignals: any }>
  }
  export const zKey: {
    exportVerificationKey: (zkey: any) => Promise<any>
    newZKey: (r1cs: any, ptau: any, zkey: any, logger?: any) => Promise<void>
    beacon: (zkey: any, beacon: any, iteration: any, logger?: any) => Promise<void>
  }
  export const wtns: {
    calculate: (input: any, wasm: any, wtns: any) => Promise<void>
  }
}
