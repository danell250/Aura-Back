export const renderReportTrendSvgTemplate = (params: {
  width: number;
  height: number;
  marginLeft: number;
  marginTop: number;
  chartWidth: number;
  chartHeight: number;
  maxYLabel: string;
  impressionsPath: string;
  clicksPath: string;
}): string => `
  <svg width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}" role="img" aria-label="Impressions and clicks trend">
    <rect x="0" y="0" width="${params.width}" height="${params.height}" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
    <line x1="${params.marginLeft}" y1="${params.marginTop + params.chartHeight}" x2="${params.marginLeft + params.chartWidth}" y2="${params.marginTop + params.chartHeight}" stroke="#cbd5e1" stroke-width="1" />
    <line x1="${params.marginLeft}" y1="${params.marginTop}" x2="${params.marginLeft}" y2="${params.marginTop + params.chartHeight}" stroke="#cbd5e1" stroke-width="1" />
    <polyline points="${params.impressionsPath}" fill="none" stroke="#059669" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    <polyline points="${params.clicksPath}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
    <text x="${params.marginLeft}" y="14" font-size="11" fill="#475569" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">Max ${params.maxYLabel}</text>
    <text x="${params.width - 94}" y="14" font-size="11" fill="#059669" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">● Impressions</text>
    <text x="${params.width - 94}" y="30" font-size="11" fill="#10b981" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">● Clicks</text>
  </svg>
`;
