export interface WorkspaceEntry {
  name: string;
  size?: number;
  type: "directory" | "file";
}
