import { LorebookApp } from "@/components/LorebookApp";
import {
  resolveVanaDefaultEnv,
  resolveVanaDefaultNetwork,
} from "@/lib/vana/runtime";

export default function Home() {
  return (
    <LorebookApp
      defaultEnv={resolveVanaDefaultEnv(process.env)}
      defaultNetwork={resolveVanaDefaultNetwork(process.env)}
    />
  );
}
