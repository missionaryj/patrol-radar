import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./main.ts',import.meta.url),'utf8');

describe('manual Patrol scanning',()=>{
  it('never auto-starts on mode selection, launch, or URL override',()=>{
    const choice=code.split('function chooseExperience(')[1].split("\n}")[0];
    expect(choice).not.toMatch(/\bstart\(/);
    expect(code).not.toContain("setTimeout(start, 0)");
    expect(code).toContain("const bootScanStop = Promise.resolve(nativePlugin()?.stop?.())");
  });
  it('stops existing scan when changing modes and uses the Scan button to start',()=>{
    expect(code).toContain("if(scanner)stop(); else ++scanGeneration");
    expect(code).toContain("$('scan').onclick = () => (scanner ? stop() : start())");
    expect(code).toContain("if(generation!==scanGeneration)");
  });
});
