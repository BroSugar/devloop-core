package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeBill(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "bill.txt")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("写入临时账单失败: %v", err)
	}
	return path
}

func TestRunSummarizesBill(t *testing.T) {
	path := writeBill(t, "USD 12.34\nUSD 0.66\nEUR 5.00\n")
	out, err := Run([]string{path})
	if err != nil {
		t.Fatalf("Run 失败: %v", err)
	}
	want := "EUR 5.00\nUSD 13.00\n"
	if out != want {
		t.Fatalf("输出不匹配\n got: %q\nwant: %q", out, want)
	}
}

func TestRunRejectsMissingArg(t *testing.T) {
	if _, err := Run(nil); err == nil {
		t.Fatal("缺少参数应报错")
	}
}
