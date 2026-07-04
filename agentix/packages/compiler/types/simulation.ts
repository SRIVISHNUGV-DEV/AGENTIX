export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  estimatedCostWei: string;
  estimatedCostEth: string;
}

export interface SimulatedStep {
  nodeId: string;
  success: boolean;
  reverted: boolean;
  revertReason?: string;
  gasEstimate?: GasEstimate;
  error?: string;
}

export interface SimulationResult {
  success: boolean;
  steps: SimulatedStep[];
  totalGasEstimate?: GasEstimate;
  warnings: string[];
  errors: string[];
}
