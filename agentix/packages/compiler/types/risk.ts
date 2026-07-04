export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'AUTHORITY';

export interface RiskFactor {
  name: string;
  weight: number;
  score: number;
  reason: string;
}

export interface RiskWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface RiskSuggestion {
  code: string;
  message: string;
  mitigation: string;
}

export interface RiskAssessment {
  score: number;
  category: RiskCategory;
  factors: RiskFactor[];
  warnings: RiskWarning[];
  suggestions: RiskSuggestion[];
  requiresApproval: boolean;
}

export const RISK_THRESHOLDS = {
  LOW_MAX: 25,
  MEDIUM_MAX: 50,
  HIGH_MAX: 75,
  DEFAULT_APPROVAL_THRESHOLD: 75,
} as const;
