declare module "circomlibjs" {
    export function buildPoseidon(): Promise<{
        F: {
            toString(val: any): string
            toObject(val: any): any
            eq(a: any, b: any): boolean
            add(a: any, b: any): any
            mul(a: any, b: any): any
            sub(a: any, b: any): any
            neg(a: any): any
            inv(a: any): any
            one: any
            zero: any
        }
        (inputs: bigint[]): any
    }>

    export function buildMimcSponge(): Promise<any>
    export function buildBabyJub(): Promise<any>
    export function buildPedersenHash(): Promise<any>
    export function buildEddsa(): Promise<any>
}
