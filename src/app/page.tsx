import { LorebookApp } from "@/components/LorebookApp";
import { resolveVanaDefaultNetwork } from "@/lib/vana/runtime";

export default function Home() {
  return (
    <LorebookApp defaultNetwork={resolveVanaDefaultNetwork(process.env)} />
  );
}
