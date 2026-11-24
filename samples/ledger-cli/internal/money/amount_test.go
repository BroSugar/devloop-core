package money

import (
	"testing"
)

func TestNewRejectsBadCurrency(t *testing.T) {
	for _, cur := range []string{"", "usd", "US", "USDX"} {
		if _, err := New(100, cur); err == nil {
			t.Fatalf("币种 %q 应该被拒绝", cur)
		}
	}
}

func TestNewAcceptsValidCurrency(t *testing.T) {
	a, err := New(1234, "USD")
	if err != nil {
		t.Fatalf("USD 应该被接受: %v", err)
	}
	if a.Cents != 1234 || a.Currency != "USD" {
		t.Fatalf("字段不正确: %+v", a)
	}
}

func TestFormat(t *testing.T) {
	cases := []struct {
		cents int64
		want  string
	}{
		{1234, "USD 12.34"},
		{5, "USD 0.05"},
		{0, "USD 0.00"},
		{-5, "-USD 0.05"},
	}
	for _, c := range cases {
		got := Amount{Cents: c.cents, Currency: "USD"}.Format()
		if got != c.want {
			t.Fatalf("Format(%d) = %q, want %q", c.cents, got, c.want)
		}
	}
}

func TestParseRoundTrip(t *testing.T) {
	a, err := Parse("USD 12.34")
	if err != nil {
		t.Fatalf("Parse 失败: %v", err)
	}
	if a.Cents != 1234 || a.Currency != "USD" {
		t.Fatalf("Parse 结果不正确: %+v", a)
	}
	if _, err := Parse("12.34"); err == nil {
		t.Fatal("缺少币种应报错")
	}
}
