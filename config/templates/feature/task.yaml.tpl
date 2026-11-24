# 模板：feature / task —— 由 new-task 实例化
# 结构（字段名、必需项）由模板保证，业务内容由需求填充。
id: {{id}}
title: {{title}}
requirement: {{requirement}}
autonomy: {{autonomy}}
depends_on: [{{depends_on}}]
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
