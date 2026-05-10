import fs from "fs"
import path from "path"
import { groth16 } from "snarkjs"

const CIRCUIT_WASM_PATH = path.resolve(
    __dirname,
    "../../../circuits/build/credential_js/credential.wasm"
)

const CIRCUIT_ZKEY_PATH = resolveZkeyPath()

function resolveZkeyPath(){
    const buildDir = path.resolve(__dirname, "../../../circuits/build")
    const zkey = fs.readdirSync(buildDir).find((file) => file.endsWith(".zkey"))

    if(!zkey){
        throw new Error(`No .zkey file found in ${buildDir}`)
    }

    return path.join(buildDir, zkey)
}

export async function generateProof(db:any,input:any){

    const cacheKey = JSON.stringify(input)

    const cached = await db.get(
        `
        SELECT *
        FROM proof_cache
        WHERE key=?
        `,
        cacheKey
    )

    if(cached){

        return {
            proof: JSON.parse(cached.proof),
            publicSignals: JSON.parse(cached.public_signals)
        }
    }

    const { proof, publicSignals } =
        await groth16.fullProve(
            input,
            CIRCUIT_WASM_PATH,
            CIRCUIT_ZKEY_PATH
        )

    await db.run(
        `
        INSERT INTO proof_cache
        (key,proof,public_signals,created_at)
        VALUES (?,?,?,?)
        `,
        cacheKey,
        JSON.stringify(proof),
        JSON.stringify(publicSignals),
        Date.now()
    )

    return { proof, publicSignals }
}
