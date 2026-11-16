export interface FormatMessageInput {
  name: string;
  punctuation?: string;
}

/**
 * Build the greeting that the CLI prints.
 *
 * @param input - Who to greet, and the punctuation to close the greeting with.
 * @returns The greeting, ready to write to stdout.
 */
export const formatMessage = (input: FormatMessageInput): string => {
  const { name, punctuation = "!" } = input;

  return `Hello, ${name}${punctuation}`;
};

/**
 * Sum two numbers. A placeholder for real library logic, kept so the test suite
 * and the coverage thresholds have something to exercise.
 *
 * @param left - First addend.
 * @param right - Second addend.
 * @returns The total of both addends.
 */
export const add = (left: number, right: number): number => left + right;
