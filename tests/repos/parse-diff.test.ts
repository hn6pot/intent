import { expect, test } from 'claude-code/testing'
import { parseDiff } from '../../hooks/repos/parse-diff'

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +12,6 @@ function f() {
 keep
-old
+new
+more
 keep
@@ -40,2 +44,2 @@
-x
+y
 z
diff --git a/src/added.ts b/src/added.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1,2 @@
+one
+two
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-a
-b
-c
diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 5555555..6666666 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1 +1 @@
-before
+after
diff --git a/img.png b/img.png
index 7777777..8888888 100644
Binary files a/img.png and b/img.png differ
diff --git a/my file.ts b/my file.ts
index 9999999..aaaaaaa 100644
--- a/my file.ts
+++ b/my file.ts
@@ -1 +1 @@
-p
+q
`

const byPath = (path: string) => parseDiff(DIFF).find(f => f.path === path)!

test('a modified file with two hunks: header and new range are read from the @@ line', () => {
  const file = byPath('src/a.ts')
  expect(file.status).toBe('modified')
  expect(file.binary).toBe(false)
  expect(file.hunks.length).toBe(2)
  expect(file.hunks[0].header).toBe('@@ -10,4 +12,6 @@ function f() {')
  expect(file.hunks[0].newStart).toBe(12)
  expect(file.hunks[0].newLines).toBe(6)
  expect(file.hunks[0].text).toBe('@@ -10,4 +12,6 @@ function f() {\n keep\n-old\n+new\n+more\n keep')
  expect(file.hunks[1].newStart).toBe(44)
  expect(file.hunks[1].newLines).toBe(2)
})

test('a hunk without a count in its new range holds one line', () => {
  const file = byPath('new/name.ts')
  expect(file.hunks[0].newStart).toBe(1)
  expect(file.hunks[0].newLines).toBe(1)
})

test('an added file', () => {
  const file = byPath('src/added.ts')
  expect(file.status).toBe('added')
  expect(file.hunks[0].newLines).toBe(2)
})

test('an added file is also recognised from --- /dev/null alone', () => {
  const text = 'diff --git a/n.ts b/n.ts\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1 @@\n+x\n'
  expect(parseDiff(text)[0].status).toBe('added')
})

test('a deleted file keeps its path', () => {
  const file = byPath('src/gone.ts')
  expect(file.status).toBe('deleted')
  expect(file.hunks[0].newStart).toBe(0)
  expect(file.hunks[0].newLines).toBe(0)
})

test('a renamed file: new path and oldPath', () => {
  const file = byPath('new/name.ts')
  expect(file.status).toBe('renamed')
  expect(file.oldPath).toBe('old/name.ts')
})

test('a binary file has no hunk', () => {
  const file = byPath('img.png')
  expect(file.binary).toBe(true)
  expect(file.hunks).toEqual([])
  expect(file.status).toBe('modified')
})

test('a path with a space', () => {
  const file = byPath('my file.ts')
  expect(file.status).toBe('modified')
  expect(file.hunks.length).toBe(1)
})

test('all files come out in order and nothing else', () => {
  expect(parseDiff(DIFF).map(f => f.path)).toEqual([
    'src/a.ts', 'src/added.ts', 'src/gone.ts', 'new/name.ts', 'img.png', 'my file.ts',
  ])
  expect(parseDiff('')).toEqual([])
})

test('a binary file added with --no-index', () => {
  const text = 'diff --git a/b.bin b/b.bin\nnew file mode 100644\nindex 0000000..1234567\nBinary files /dev/null and b/b.bin differ\n'
  const file = parseDiff(text)[0]
  expect(file).toEqual({ path: 'b.bin', status: 'added', binary: true, hunks: [] })
})

test('a non-ASCII path (git run with core.quotepath=off)', () => {
  const text = 'diff --git a/café.txt b/café.txt\n--- a/café.txt\n+++ b/café.txt\n@@ -1 +1 @@\n-a\n+b\n'
  expect(parseDiff(text)[0].path).toBe('café.txt')
})
