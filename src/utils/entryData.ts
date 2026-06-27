export const entryData = (data: any, values: unknown[], updates: string[]) => {
    Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) {
        values.push(value);
        updates.push(`${key} = $${values.length}`);
        }
    });
}