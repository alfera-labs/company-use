export function parse_json_config<T>(
  config_name: string,
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: SchemaFailure };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`${config_name} is not valid: ${issues}`);
}

type SchemaFailure = {
  issues: { path: PropertyKey[]; message: string }[];
};
