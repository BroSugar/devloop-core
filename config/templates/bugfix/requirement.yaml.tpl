# 模板：bugfix / requirement —— 与 feature 的差别只在于多了缺陷来源字段。
# “模板可配置”的意义：流程相同、字段不同，不需要改引擎。
id: {{id}}
title: {{title}}
status: {{status}}
kind: bugfix
autonomy: {{autonomy}}
owner: {{owner}}
regression_of: {{regression_of}}
reproduced_by: {{reproduced_by}}
summary: |
  {{summary}}
policy:
  deny_write:
    - "**/*_test.go"
    - "**/*.test.mjs"
acceptance:
  {{acceptance_block}}
