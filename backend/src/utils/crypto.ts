import { buildPoseidon } from "circomlibjs"
let poseidonInstance:any

export async function initCrypto(){
    if(!poseidonInstance){
        poseidonInstance = await buildPoseidon()
    }
}

export function poseidonHash(inputs:bigint[]):bigint{

    if(!poseidonInstance){
        throw new Error("Crypto not initialized")
    }

    const res = poseidonInstance(inputs)

    return BigInt(poseidonInstance.F.toString(res))
}
