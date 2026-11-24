# 模板：bugfix / task —— 回归修复必须声明缺陷来源，且验收标准必须含“回归用例”
id: {{id}}
title: {{title}}
requirement: {{requirement}}
kind: bugfix
autonomy: {{autonomy}}
depends_on: [{{depends_on}}]
regression_of: {{regression_of}}
reproduced_by: {{reproduced_by}}
objective: |
  {{objective}}
scope:
  write:
    {{write}}
  deny:
    - "**/*_test.go"
acceptance: [{{acceptance}}]
verify:
    {{verify}}
