package money

import (
	"fmt"
	"strconv"
	"strings"
)

// Amount 是最小货币单位（分）表示的金额。
type Amount struct {
	Cents    int64
	Currency string
}

func validCurrency(currency string) bool {
	if len(currency) != 3 {
		return false
	}
	for i := 0; i < len(currency); i++ {
		if currency[i] < 'A' || currency[i] > 'Z' {
			return false
		}
	}
	return true
}

// New 创建金额。币种必须是非空的三位大写字母，例如 USD、CNY。
func New(cents int64, currency string) (Amount, error) {
	if !validCurrency(currency) {
		return Amount{}, fmt.Errorf("非法币种 %q：必须是三位大写字母", currency)
	}
	return Amount{Cents: cents, Currency: currency}, nil
}

// Format 输出 "USD 12.34"；负数输出 "-USD 0.05"。
func (a Amount) Format() string {
	sign := ""
	cents := a.Cents
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%s %d.%02d", sign, a.Currency, cents/100, cents%100)
}

// Parse 解析 "USD 12.34" / "-USD 0.05"。
func Parse(s string) (Amount, error) {
	fields := strings.Fields(strings.TrimSpace(s))
	if len(fields) != 2 {
		return Amount{}, fmt.Errorf("无法解析金额 %q：期望形如 \"USD 12.34\"", s)
	}
	currency := fields[0]
	if !validCurrency(currency) {
		return Amount{}, fmt.Errorf("非法币种 %q", currency)
	}

	number := fields[1]
	negative := strings.HasPrefix(number, "-")
	if negative {
		number = number[1:]
	}
	parts := strings.SplitN(number, ".", 2)
	if len(parts) != 2 || len(parts[1]) != 2 {
		return Amount{}, fmt.Errorf("金额 %q 必须保留两位小数", fields[1])
	}
	major, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return Amount{}, fmt.Errorf("整数部分 %q 非法: %w", parts[0], err)
	}
	minor, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return Amount{}, fmt.Errorf("小数部分 %q 非法: %w", parts[1], err)
	}

	cents := major*100 + minor
	if negative {
		cents = -cents
	}
	return Amount{Cents: cents, Currency: currency}, nil
}
