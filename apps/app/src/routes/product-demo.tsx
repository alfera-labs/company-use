import { createFileRoute, notFound } from '@tanstack/react-router';

export function answer_not_found(): never {
  throw notFound();
}

export const Route = createFileRoute('/product-demo')({ loader: answer_not_found });
