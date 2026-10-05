// Bun text import (`with { type: 'text' }`) for vendored license texts bundled into the binary.
declare module '*.txt' {
  const content: string;
  export default content;
}
