import { execSync } from 'child_process';

try {
    execSync("npm run dev", { stdio: 'inherit' });
} catch (error) {
    console.error("Failed to execute npm run dev:", error);
}