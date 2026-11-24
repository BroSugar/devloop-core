// 平台 YAML 解析器的薄封装（服务端专用），避免各处重复读文件。

import fs from 'node:fs';
import { parseYaml } from '../../platform/lib/yaml.mjs';

export { parseYaml };

export function parseYamlFile(file) {
  return parseYaml(fs.readFileSync(file, 'utf8'));
}
