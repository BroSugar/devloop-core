package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"ledger-cli/internal/money"
)

// Run 读取 args[0] 指定的账单文件（每行一条金额），返回按币种汇总的报告。
// 报告每行一条："EUR 5.00"，按币种字典序升序。
func Run(args []string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("缺少账单文件路径")
	}
	raw, err := os.ReadFile(args[0])
	if err != nil {
		return "", fmt.Errorf("读取账单失败: %w", err)
	}

	amounts := make([]money.Amount, 0, 16)
	for i, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		amount, err := money.Parse(line)
		if err != nil {
			return "", fmt.Errorf("第 %d 行: %w", i+1, err)
		}
		amounts = append(amounts, amount)
	}

	var report strings.Builder
	for _, total := range money.Sum(amounts) {
		report.WriteString(money.Amount{Cents: total.Cents, Currency: total.Currency}.Format())
		report.WriteString("\n")
	}
	return report.String(), nil
}

func main() {
	out, err := Run(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "ledger:", err)
		os.Exit(1)
	}
	fmt.Print(out)
}