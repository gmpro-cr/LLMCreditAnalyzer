import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Sparkles, ArrowLeft, Building2, UserCircle, Briefcase, FileSignature } from "lucide-react";
import { useCreateCase, useGenerateMemo, CreateCaseBodyFacilityType } from "@workspace/api-client-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  borrowerName: z.string().min(2, "Borrower name must be at least 2 characters"),
  cin: z.string().optional(),
  pan: z.string().optional(),
  facilityType: z.enum([
    "term_loan",
    "working_capital",
    "letter_of_credit",
    "bank_guarantee",
    "overdraft"
  ]),
  facilityAmount: z.coerce.number().min(100000, "Amount must be at least 1,00,000"),
  sector: z.string().min(2, "Sector is required"),
  rmName: z.string().min(2, "RM Name is required"),
});

export default function NewCase() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  
  const createCase = useCreateCase();
  const generateMemo = useGenerateMemo();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      borrowerName: "",
      cin: "",
      pan: "",
      facilityType: "term_loan",
      facilityAmount: 10000000,
      sector: "",
      rmName: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      setIsGenerating(true);
      
      // 1. Create the case
      const newCase = await createCase.mutateAsync({
        data: values
      });
      
      toast({
        title: "Case created",
        description: `Created case for ${values.borrowerName}. Initializing AI generation...`,
      });

      // 2. Trigger AI Generation
      await generateMemo.mutateAsync({ id: newCase.id });
      
      toast({
        title: "AI Generation Started",
        description: "The AI co-pilot is drafting the memo sections.",
      });

      // 3. Navigate to the editor
      setLocation(`/cases/${newCase.id}`);
      
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create case or initialize generation.",
        variant: "destructive",
      });
      setIsGenerating(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/cases" className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted h-10 w-10">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          <span className="sr-only">Back</span>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">New CAM Request</h1>
          <p className="text-muted-foreground mt-1">Provide initial parameters to generate the draft memo.</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Building2 className="h-5 w-5 text-primary" />
                Borrower Details
              </CardTitle>
              <CardDescription>
                Company identifiers and core information used to fetch external data.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="borrowerName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Entity / Borrower Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Reliance Industries Limited" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Corporate Identity Number (CIN)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. L25111MH1988PLC048925" {...field} />
                    </FormControl>
                    <FormDescription>Optional. Helps AI fetch MCA data.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. ABCDE1234F" className="uppercase" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sector"
                render={({ field }) => (
                  <FormItem className="col-span-2 md:col-span-1">
                    <FormLabel>Industry Sector</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Manufacturing, IT, Healthcare" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Briefcase className="h-5 w-5 text-primary" />
                Facility Request
              </CardTitle>
              <CardDescription>
                The credit facility parameters being proposed.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="facilityType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Facility Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select facility type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="term_loan">Term Loan</SelectItem>
                        <SelectItem value="working_capital">Working Capital</SelectItem>
                        <SelectItem value="letter_of_credit">Letter of Credit</SelectItem>
                        <SelectItem value="bank_guarantee">Bank Guarantee</SelectItem>
                        <SelectItem value="overdraft">Overdraft</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="facilityAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (INR)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserCircle className="h-5 w-5 text-primary" />
                Internal Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="rmName"
                render={({ field }) => (
                  <FormItem className="max-w-md">
                    <FormLabel>Relationship Manager Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
            <Button variant="outline" type="button" asChild>
              <Link href="/cases">Cancel</Link>
            </Button>
            <Button 
              type="submit" 
              disabled={isGenerating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[200px]"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  Generating Draft...
                </>
              ) : (
                <>
                  <FileSignature className="mr-2 h-4 w-4" />
                  Create & Generate Memo
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}