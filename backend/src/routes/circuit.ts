import express from "express"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const router = express.Router()

const VK_PATH = path.resolve(__dirname, "../../../circuits/build/verification_key.json")
const WASM_PATH = path.resolve(__dirname, "../../../circuits/build/credential_js/credential.wasm")

function checkRapidsnarkWSL(): boolean {
    try {
        execSync("wsl command -v rapidsnark", { timeout: 5000, stdio: "pipe", shell: "powershell" })
        return true
    } catch {
        return false
    }
}

router.get("/config", (_req, res) => {
    const hasWasm = fs.existsSync(WASM_PATH)
    const hasVk = fs.existsSync(VK_PATH)

    let verificationKey: object | null = null
    if (hasVk) {
        try {
            verificationKey = JSON.parse(fs.readFileSync(VK_PATH, "utf-8"))
        } catch { }
    }

    res.json({
        available: hasWasm && hasVk,
        hasWasm,
        hasZkey: fs.existsSync(path.resolve(__dirname, "../../../circuits/build")) &&
            fs.readdirSync(path.resolve(__dirname, "../../../circuits/build"))
                .some(f => f.endsWith(".zkey")),
        verificationKeyUrl: "/circuit/verification-key",
        verificationKey: verificationKey ? {
            protocol: (verificationKey as any).protocol,
            curve: (verificationKey as any).curve,
            nPublic: (verificationKey as any).nPublic,
        } : null,
        backendProvingAvailable: checkRapidsnarkWSL(),
    })
})

router.get("/verification-key", (_req, res) => {
    if (!fs.existsSync(VK_PATH)) {
        return res.status(404).json({ error: "verification_key.json not found" })
    }
    res.sendFile(VK_PATH)
})

export default router
