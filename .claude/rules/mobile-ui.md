---
paths:
  - "app/**/*.tsx"
---

# Mobile-Friendly — Detail Pola

Ringkasan blocker ada di `CLAUDE.md` (bagian Mobile-Friendly); file ini berisi pola wajib per elemen.

### 1. Navigasi — AppShell dengan Mobile Header Wajib

Jangan pernah menempatkan `<Burger>` sebagai elemen `pos="fixed"` floating tanpa `AppShell.Header`. Pola yang wajib dipakai:

```tsx
<AppShell
  header={{ height: { base: 52, sm: 0 } }}  // header hanya muncul di mobile
  navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
>
  <AppShell.Header withBorder={false} hiddenFrom="sm">
    <Group h="100%" px="md" gap="sm">
      <Burger opened={mobileOpened} onClick={toggleMobile} size="sm" aria-label="Toggle navigation" />
      <Text fw={700}>Nama App</Text>
    </Group>
  </AppShell.Header>
  <AppShell.Navbar>...</AppShell.Navbar>
  <AppShell.Main>...</AppShell.Main>
</AppShell>
```

**Blocker:** Burger floating fixed tanpa AppShell.Header → STOP.

### 2. Tabel — Kolom Wajib Responsif

Semua tabel harus scrollable horizontal DAN menyembunyikan kolom tidak esensial di mobile:

```tsx
// Wrapper scroll — wajib ada
<Box style={{ overflowX: 'auto' }}>
  <Table>
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Kolom Penting</Table.Th>
        <Table.Th visibleFrom="sm">Kolom Sekunder</Table.Th>  {/* hidden di mobile */}
      </Table.Tr>
    </Table.Thead>
    <Table.Tbody>
      <Table.Tr>
        <Table.Td>...</Table.Td>
        <Table.Td visibleFrom="sm">...</Table.Td>  {/* hidden di mobile */}
      </Table.Tr>
    </Table.Tbody>
  </Table>
</Box>
```

Alternatif: `<Table.ScrollContainer minWidth={640}>` bila semua kolom harus tampil.

**Untuk tabel dengan 4+ kolom data kaya — wajib gunakan card/list view di mobile:**

```tsx
{/* Desktop: tabel biasa */}
<Box style={{ overflowX: 'auto' }} visibleFrom="sm">
  <Table>...</Table>
</Box>

{/* Mobile: card list — semua data terlihat tanpa scroll horizontal */}
<Stack gap="xs" hiddenFrom="sm">
  {rows.map((r) => (
    <Paper key={r.id} withBorder p="sm" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          {/* Data primer: path/nama/judul — truncate dengan minWidth: 0 */}
          <Text truncate style={{ minWidth: 0 }}>{r.path}</Text>
          {/* Data sekunder: timestamp, IP, ID — dimmed, kecil */}
          <Text size="xs" c="dimmed">{fmt(r.createdAt)}</Text>
        </Stack>
        {/* Aksi: delete, edit — flexShrink: 0 agar tidak ikut dipersempit */}
        <ActionIcon style={{ flexShrink: 0 }}>...</ActionIcon>
      </Group>
    </Paper>
  ))}
</Stack>
```

Pola ini berlaku untuk semua halaman log, tabel user, dan tabel data apapun dengan ≥4 kolom.

**Prioritas kolom yang wajib tampil di mobile:** kolom identitas utama (nama/path) + status + aksi.
**Kolom yang boleh disembunyikan di mobile dengan `visibleFrom="sm"`:** IP, User Agent, User ID, timestamp sekunder, kolom detail.

**Blocker:** Tabel ≥4 kolom tanpa card view mobile DAN tanpa `overflowX: 'auto'` → STOP.

### 3. Page Header — Tombol Action Wajib Wrap

Header halaman yang berisi judul + tombol-tombol wajib menggunakan `wrap="wrap"`:

```tsx
// ✅ Benar — buttons wrap ke bawah bila tidak muat
<Group justify="space-between" align="flex-start" wrap="wrap">
  <Title order={3}>Judul Halaman</Title>
  <Group gap="xs" wrap="wrap" justify="flex-end">
    <Button>Clear All</Button>
    <Button>Purge 30d+</Button>
    <Button>Refresh</Button>
  </Group>
</Group>

// ❌ Salah — buttons overflow layar di mobile
<Group justify="space-between" wrap="nowrap">
```

**Blocker:** Header dengan `wrap="nowrap"` yang berisi tombol-tombol → STOP.

### 4. Layout & Spacing

- Gunakan Mantine `Grid`, `SimpleGrid`, `Stack` dengan breakpoints — **bukan** fixed-width pixel.
- `width: 800px`, `minWidth: 600px` pada container utama → gunakan `maw` + `w="100%"` sebagai gantinya.
- Padding halaman: minimal `p="sm"` di mobile — gunakan `p={{ base: 'sm', md: 'md' }}` bila perlu.
- Kolom grid yang tidak muat di mobile → `cols={{ base: 1, sm: 2, md: 3 }}`.

### 5. Touch Targets

- Tombol aksi utama: minimum `size="sm"` (44px touch area).
- `ActionIcon` kecil di dalam tabel: boleh `size="xs"` karena tabel sudah scrollable.
- Jarak antar touch target: minimal `gap="xs"`.
- Hindari link/button berdekatan tanpa jarak yang cukup.

### 6. Form & Input

- Set `inputMode` yang sesuai: `inputMode="email"`, `inputMode="numeric"`, `inputMode="url"`.
- Jangan set `font-size` di bawah 16px pada input — browser mobile akan auto-zoom.
- Mantine input component sudah handle ini secara default, jangan override ke ukuran lebih kecil.

