export interface MerkleTreeNode {
  key: bigint;
  value: bigint;
  left?: MerkleTreeNode;
  right?: MerkleTreeNode;
  hash: bigint;
}

export interface MerkleProofPath {
  pathElements: bigint[];
  pathIndices: number[];
}

export interface MerkleTreeSnapshot {
  root: bigint;
  nodes: Map<string, bigint>;
  leaves: Map<bigint, bigint>;
  epoch: number;
  timestamp: number;
}

export interface ActiveTreeData {
  leaves: Map<bigint, bigint>;
  root: bigint;
  epoch: number;
}

export interface RevokedTreeData {
  leaves: Set<bigint>;
  root: bigint;
  epoch: number;
}
