export interface ProcessLogEntry {
  pid: string;
  seq: number;
  stream: "stdout" | "stderr" | "exit";
  text: string;
  timestamp: number;
}
