import {
  Accordion,
  Anchor,
  Badge,
  Box,
  Card,
  Code,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { ARCH, CONSOLE_PAGES, FAQ, FEATURES, SECURITY_POINTS, STACK } from './landing.content';

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <Stack gap={6} mb="xl" id={id} style={{ scrollMarginTop: 80 }}>
      <Text size="xs" c="blue" fw={700} tt="uppercase" lts={1}>
        {eyebrow}
      </Text>
      <Title order={2} fz={{ base: 28, md: 36 }} lh={1.15}>
        {title}
      </Title>
      <Text c="dimmed" maw={680}>
        {lead}
      </Text>
    </Stack>
  );
}

export function FeaturesSection() {
  return (
    <Container size="lg" component="section" py={{ base: 40, md: 72 }}>
      <SectionHeading
        id="fitur"
        eyebrow="Fondasi"
        title="Semua yang biasanya Anda rakit sendiri selama seminggu pertama"
        lead="Bukan boilerplate yang perlu banyak konfigurasi. Setiap bagian sudah terhubung, teruji, dan dipakai oleh konsolnya sendiri."
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {FEATURES.map((f) => (
          <Card key={f.title} withBorder radius="md" padding="lg">
            <ThemeIcon variant="light" color={f.color} size={40} radius="md" mb="sm">
              <f.icon size={20} />
            </ThemeIcon>
            <Text fw={600} mb={4}>
              {f.title}
            </Text>
            <Text size="sm" c="dimmed">
              {f.desc}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
    </Container>
  );
}

export function ConsoleSection() {
  const groups = Array.from(new Set(CONSOLE_PAGES.map((p) => p.group)));
  return (
    <Box
      component="section"
      py={{ base: 40, md: 72 }}
      style={{ background: 'var(--mantine-color-default-hover)' }}
    >
      <Container size="lg">
        <SectionHeading
          id="konsol"
          eyebrow="Konsol admin"
          title={`${CONSOLE_PAGES.length} halaman operasional, siap dipakai tim Anda`}
          lead="Setiap halaman mengikuti standar yang sama: data lengkap di paint pertama, filter, detail, konfirmasi aksi berbahaya, notifikasi, dan tampilan mobile."
        />
        <Stack gap="lg">
          {groups.map((g) => (
            <Stack key={g} gap="sm">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} lts={0.5}>
                {g}
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                {CONSOLE_PAGES.filter((p) => p.group === g).map((p) => (
                  <Paper key={p.label} withBorder radius="md" p="md">
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <ThemeIcon variant="light" size={34} radius="md">
                        <p.icon size={16} />
                      </ThemeIcon>
                      <div style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm">
                          {p.label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {p.desc}
                        </Text>
                      </div>
                    </Group>
                  </Paper>
                ))}
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      </Container>
    </Box>
  );
}

export function SecuritySection() {
  return (
    <Container size="lg" component="section" py={{ base: 40, md: 72 }}>
      <SectionHeading
        id="keamanan"
        eyebrow="Keamanan & operasional"
        title="Hal-hal yang baru terasa penting saat sudah live"
        lead="Pengalaman produksi dibangun ke dalam template, bukan ditambal belakangan."
      />
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {SECURITY_POINTS.map((p) => (
          <Group key={p.title} gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color="teal" size={36} radius="md" style={{ flexShrink: 0 }}>
              <p.icon size={16} />
            </ThemeIcon>
            <div>
              <Text fw={600} size="sm">
                {p.title}
              </Text>
              <Text size="sm" c="dimmed">
                {p.desc}
              </Text>
            </div>
          </Group>
        ))}
      </SimpleGrid>
    </Container>
  );
}

export function ArchitectureSection() {
  return (
    <Box
      component="section"
      py={{ base: 40, md: 72 }}
      style={{ background: 'var(--mantine-color-default-hover)' }}
    >
      <Container size="lg">
        <SectionHeading
          id="arsitektur"
          eyebrow="Arsitektur"
          title="Satu proses, empat jalur, nol konfigurasi CORS"
          lead="Karena frontend dan backend satu origin, cookie langsung bekerja, Eden client memakai URL relatif, dan deploy hanya butuh satu artefak."
        />
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl" style={{ alignItems: 'start' }}>
          <Code block style={{ fontSize: 12.5, lineHeight: 1.5, overflowX: 'auto' }}>
            {ARCH}
          </Code>
          <Stack gap="md">
            {[
              [
                'Dev = prod',
                'Server dev memakai Vite middleware untuk HMR, server prod memakai bundle. Routing dan auth persis sama.',
              ],
              [
                'Loader dengan sesi',
                'requireRole() di loader membaca cookie sesi, memvalidasi role, dan redirect sebelum satu byte HTML dikirim.',
              ],
              [
                'Analytics tanpa beban',
                'Kunjungan dan login dicatat fire-and-forget; geo dari header proxy, perangkat dari parser UA bawaan.',
              ],
              [
                'Binary terkompilasi',
                'bun build --compile membungkus runtime, SSR, dan aset. Migrasi tetap dijalankan dari repo saat rilis.',
              ],
            ].map(([t, d]) => (
              <div key={t}>
                <Text fw={600} size="sm">
                  {t}
                </Text>
                <Text size="sm" c="dimmed">
                  {d}
                </Text>
              </div>
            ))}
            <Group gap={6} wrap="wrap" mt="xs">
              {STACK.map((s) => (
                <Badge key={s.label} variant="light" color={s.color} size="sm">
                  {s.label}
                </Badge>
              ))}
            </Group>
          </Stack>
        </SimpleGrid>
      </Container>
    </Box>
  );
}

export function FaqSection() {
  return (
    <Container size="md" component="section" py={{ base: 40, md: 72 }}>
      <SectionHeading
        id="faq"
        eyebrow="FAQ"
        title="Pertanyaan yang sering muncul"
        lead="Jawaban singkat dan jujur, termasuk batasannya."
      />
      <Accordion variant="separated" radius="md">
        {FAQ.map((f) => (
          <Accordion.Item key={f.q} value={f.q}>
            <Accordion.Control>
              <Text fw={600} size="sm">
                {f.q}
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed">
                {f.a}
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Text size="sm" c="dimmed" mt="md">
        Pertanyaan lain? Buka{' '}
        <Anchor
          href="https://github.com/bipprojectbali/st4s/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          issue di GitHub
        </Anchor>
        .
      </Text>
    </Container>
  );
}
