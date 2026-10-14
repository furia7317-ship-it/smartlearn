export type CodeLanguage = "python" | "java" | "c" | "cpp";
export const CODE_LANGUAGES = {
  python: { label: "Python", filename: "main.py", extension: "py", starter: 'print("Python 实训环境已就绪")\n\n# 读取标准输入示例：name = input()\n' },
  java: { label: "Java", filename: "Main.java", extension: "java", starter: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner input = new Scanner(System.in);\n        System.out.println("Java 实训环境已就绪");\n        // 在此编写实现，可用 input.nextLine() 读取标准输入\n    }\n}\n' },
  c: { label: "C", filename: "main.c", extension: "c", starter: '#include <stdio.h>\n\nint main(void) {\n    printf("C 实训环境已就绪\\n");\n    // 在此编写实现，可用 scanf 读取标准输入\n    return 0;\n}\n' },
  cpp: { label: "C++", filename: "main.cpp", extension: "cpp", starter: '#include <iostream>\n#include <string>\nusing namespace std;\n\nint main() {\n    cout << "C++ 实训环境已就绪" << endl;\n    // 在此编写实现，可用 cin 读取标准输入\n    return 0;\n}\n' },
} as const;

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return typeof value === "string" && Object.hasOwn(CODE_LANGUAGES, value);
}
