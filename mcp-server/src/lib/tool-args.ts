// The low-level MCP Server does not check tool arguments against inputSchema, so
// `required`, `enum` and `type` were advisory: side "buy" built a SELL order,
// isBuy "false" became true. Every call is validated here before it reaches a handler.
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';

type Tool = { name: string; inputSchema: unknown };

export function toolArgsValidator(tools: Tool[]): (name: string, args: unknown) => string | null {
  const ajv = new AjvJsonSchemaValidator();
  const schemas = new Map(tools.map(t => [t.name, t.inputSchema as JsonSchemaType]));
  const compiled = new Map<string, JsonSchemaValidator<unknown>>();
  return (name, args) => {
    const schema = schemas.get(name);
    if (!schema) return null; // unknown tools are reported by the router
    let validate = compiled.get(name);
    if (!validate) compiled.set(name, (validate = ajv.getValidator(schema)));
    const r = validate(args ?? {});
    return r.valid ? null : `Invalid arguments for ${name}: ${r.errorMessage}`;
  };
}
