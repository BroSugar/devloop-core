package money

import "sort"

// Total 是某个币种的汇总结果。
type Total struct {
	Currency string
	Cents    int64
}

// Sum 按币种分组汇总，结果按币种字典序升序；不同币种不混合相加。
func Sum(amounts []Amount) []Total {
	byCurrency := make(map[string]int64, len(amounts))
	for _, amount := range amounts {
		byCurrency[amount.Currency] += amount.Cents
	}

	totals := make([]Total, 0, len(byCurrency))
	for currency, cents := range byCurrency {
		totals = append(totals, Total{Currency: currency, Cents: cents})
	}
	sort.Slice(totals, func(i, j int) bool {
		return totals[i].Currency < totals[j].Currency
	})
	return totals
}
