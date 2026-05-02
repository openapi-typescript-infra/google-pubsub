import { execSync } from 'child_process';
import { copyFileSync, unlinkSync } from 'fs';
import path from 'path';

import { describe, expect, test } from 'vitest';

const tsConfigPath = path.resolve(__dirname, './type-tests/tsconfig.test.json');

function compileTypeScriptFile(filePath: string) {
  const tempFilePath = filePath.replace('.template', '');

  try {
    copyFileSync(filePath, tempFilePath);
    const stdout = execSync(`./node_modules/.bin/tsc --project ${tsConfigPath}`);
    return { success: true, output: stdout.toString() };
  } catch (error) {
    return { success: false, output: (error as { stdout?: Buffer }).stdout?.toString() };
  } finally {
    // Clean up: remove the temporary file
    try {
      unlinkSync(tempFilePath);
    } catch (cleanupError) {
      // eslint-disable-next-line no-console
      console.error('Error cleaning up temporary file:', cleanupError);
    }
  }
}

describe('type tests', () => {
  test('good types', () => {
    const result = compileTypeScriptFile(path.resolve(__dirname, 'type-tests/good.ts.template'));
    expect(result.success).toBe(true);
  });

  test('bad types', () => {
    const { success, output } = compileTypeScriptFile(
      path.resolve(__dirname, 'type-tests/bad.ts.template'),
    );
    expect(output || '').includes(
      'type-tests/bad.ts(7,3): error TS2322: Type \'() => "not ok"\' is not assignable to type',
    );
    expect(output || '').includes(
      "type-tests/bad.ts(17,3): error TS2322: Type '() => void' is not assignable to type",
    );
    expect(output || '').includes(
      'type-tests/bad.ts(27,3): error TS2322: Type \'() => "not ok"\' is not assignable to type',
    );
    expect(output || '').includes(
      'type-tests/bad.ts(37,3): error TS2322: Type \'() => "not ok"\' is not assignable to type',
    );
    expect(output || '').includes(
      "type-tests/bad.ts(47,3): error TS2322: Type '() => void' is not assignable to type",
    );
    expect(output || '').includes(
      'type-tests/bad.ts(57,3): error TS2322: Type \'() => "not ok"\' is not assignable to type',
    );
    expect(success).toBe(false);
  });
});
