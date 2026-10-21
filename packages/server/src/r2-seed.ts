import { seedR2FromLocalFiles } from "./r2-persistence";
import { rebuildFishMetadataIndexFromDisk } from "./fish-library";

const dryRun = process.argv.includes("--dry-run");
if (!dryRun) rebuildFishMetadataIndexFromDisk();
const count = await seedR2FromLocalFiles({ dryRun });
console.log(dryRun
  ? `[R2] ${count} aquarium files are ready to upload. No files were sent.`
  : `[R2] Uploaded ${count} existing aquarium files.`);
