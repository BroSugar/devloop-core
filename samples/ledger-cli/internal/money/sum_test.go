package money

import (
	"testing"
)

func TestSumGroupsByCurrency(t *testing.T) {
	totals := Sum([]Amount{
		{Cents: 1234, Currency: "USD"},
		{Cents: 66, Currency: "USD"},
		{Cents: 500, Currency: "EUR"},
	})
	if len(totals) != 2 {
		t.Fatalf("应分 2 组，实际 %d", len(totals))
	}
	if totals[0].Currency != "EUR" || totals[0].Cents != 500 {
		t.Fatalf("排序或分组错误: %+v", totals)
	}
	if totals[1].Currency != "USD" || totals[1].Cents != 1300 {
		t.Fatalf("求和错误: %+v", totals)
	}
}

func TestSumEmpty(t *testing.T) {
	if got := Sum(nil); len(got) != 0 {
		t.Fatalf("空输入应返回空结果，实际 %+v", got)
	}
}
