/** Current protocol prices from wallet/getchainparameters; no fixed SUN fee guess.
 * References: developers.tron.network/reference/wallet-getchainparameters and
 * tronprotocol.github.io/documentation-en/clients/wallet-cli/java/commands/account/
 */
export function tronFeeReserve(rawDataHex, feeLimitSun, nativeTransfer, parameters) {
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(rawDataHex) || rawDataHex.length / 2 > 4096)
        throw new Error('Cannot bound Tron transaction size.');
    const rows = parameters?.chainParameter;
    if (!Array.isArray(rows))
        throw new Error('Tron fee parameters unavailable.');
    const read = (key) => {
        const row = rows.find((r) => r.key === key);
        if (!row || !Number.isSafeInteger(row.value) || row.value < 0)
            throw new Error(`Invalid Tron fee parameter ${key}.`);
        return BigInt(row.value);
    };
    // Includes conservative protobuf envelope/signature/receipt overhead.
    const bandwidth = BigInt(rawDataHex.length / 2 + 256) * read('getTransactionFee');
    const activation = nativeTransfer ? read('getCreateAccountFee') + read('getCreateNewAccountFeeInSystemContract') : 0n;
    return feeLimitSun + bandwidth + activation;
}
