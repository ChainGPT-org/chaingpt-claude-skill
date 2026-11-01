// The low-level MCP Server does not check tool arguments against inputSchema, so
// `required`, `enum` and `type` were advisory: side "buy" built a SELL order,
// isBuy "false" became true. Every call is validated here before it reaches a handler.
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
export function toolArgsValidator(tools) {
    const ajv = new AjvJsonSchemaValidator();
    const schemas = new Map(tools.map(t => [t.name, t.inputSchema]));
    const compiled = new Map();
    return (name, args) => {
        const schema = schemas.get(name);
        if (!schema)
            return null; // unknown tools are reported by the router
        let validate = compiled.get(name);
        if (!validate)
            compiled.set(name, (validate = ajv.getValidator(schema)));
        const r = validate(args ?? {});
        return r.valid ? null : `Invalid arguments for ${name}: ${r.errorMessage}`;
    };
}
