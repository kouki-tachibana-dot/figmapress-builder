import mockFigma from "../../../../examples/mock-figma.json";
import { ConverterApp } from "@/components/converter-app";

export default function HomePage() {
  return <ConverterApp sampleJson={JSON.stringify(mockFigma, null, 2)} />;
}
