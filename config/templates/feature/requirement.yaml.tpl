# 模板：feature / requirement  —— 由 new-requirement 实例化
id: {{id}}
title: {{title}}
status: {{status}}
autonomy: {{autonomy}}
owner: {{owner}}
summary: |
  {{summary}}
policy:
  deny_write:
    - "**/*_test.go"
    - "**/*.test.mjs"
acceptance:
  {{acceptance_block}}
